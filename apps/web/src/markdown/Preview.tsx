import { ASSET_SCHEME } from '@memora/shared';
import type { Element, ElementContent, Root, RootContent } from 'hast';
import { toJsxRuntime, type Components } from 'hast-util-to-jsx-runtime';
import { Check, Copy, PenLine } from 'lucide-react';
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { DrawnDiagram } from '../diagrams/DrawnDiagram';
import { cn } from '../lib/cn';
import { useFileSrc, usePreviewHost } from './context';
import { ImageViewer } from './ImageViewer';
import { PageHoverCard } from './PageCard';
import { highlight } from './highlight';
import './markdown.css';
import { createRenderer, type Renderer } from './renderer';
import { openCardKey, useCardKeys } from '../kanban/keys';

/*
 * The rendered page (§9.3): everything in the dialect, sanitised, with code highlighted by
 * Shiki, maths by KaTeX and diagrams by Mermaid, each loaded only when a page needs it. Top-level
 * blocks render on their own, so typing re-renders only the blocks that changed.
 */

let shared: Renderer | null = null;
const renderer = () => (shared ??= createRenderer());

/** Clicking a task box: toggles the box on that source line. */
const TaskContext = createContext<((line: number) => void) | undefined>(undefined);
/** Editing a diagram: opens the diagram editor for the block on that source line. */
const DiagramContext = createContext<((line: number) => void) | undefined>(undefined);

/** Waits a little after typing; longer for pages that take longer to render. */
function useRendered(text: string): { hast: Root | null; source: string } {
  const [state, setState] = useState<{ hast: Root | null; source: string }>({
    hast: null,
    source: '',
  });
  const cost = useRef(0);
  const first = useRef(true);
  useEffect(() => {
    let live = true;
    const delay = first.current ? 0 : Math.min(600, 80 + cost.current * 2);
    first.current = false;
    const timer = setTimeout(() => {
      const started = performance.now();
      renderer()
        .render(text)
        .then((hast) => {
          cost.current = performance.now() - started;
          if (live) setState({ hast, source: text });
        })
        .catch(() => undefined);
    }, delay);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [text]);
  return state;
}

export interface PreviewProps {
  text: string;
  /** Makes task boxes clickable: called with the line of the box. */
  onToggleTask?: (line: number) => void;
  /** Gives diagrams an Edit button: called with the line of the diagram's fence. */
  onEditDiagram?: (line: number) => void;
  className?: string;
  /** Receives the element whose descendants carry `data-line` (for scroll sync). */
  bodyRef?: (element: HTMLDivElement | null) => void;
}

export const Preview = memo(function Preview({
  text,
  onToggleTask,
  onEditDiagram,
  className,
  bodyRef,
}: PreviewProps) {
  const { hast, source } = useRendered(text);
  const blocks = hast?.children ?? [];
  const seen = new Map<string, number>();
  return (
    <TaskContext.Provider value={onToggleTask}>
      <DiagramContext.Provider value={onEditDiagram}>
        <div
          ref={bodyRef}
          className={cn('markdown-body', className)}
          data-rendered={hast ? 'true' : undefined}
        >
          {blocks.map((node) => {
            if (node.type === 'text' && !node.value.trim()) return null;
            const slice = sourceOf(node, source);
            // Same text, same key: an unchanged block keeps its element.
            const count = seen.get(slice) ?? 0;
            seen.set(slice, count + 1);
            return (
              <Block
                key={`${slice}\u0000${count}`}
                node={node}
                slice={slice}
                line={node.position?.start.line ?? 0}
              />
            );
          })}
        </div>
      </DiagramContext.Provider>
    </TaskContext.Provider>
  );
});

function sourceOf(node: RootContent, source: string): string {
  const { start, end } = node.position ?? {};
  if (start?.offset !== undefined && end?.offset !== undefined) {
    return source.slice(start.offset, end.offset);
  }
  // No position (the footnotes list): its content is its identity.
  return JSON.stringify(node);
}

const Block = memo(
  function Block({ node }: { node: RootContent; slice: string; line: number }) {
    return toJsxRuntime(node, { Fragment, jsx, jsxs, components, passNode: true });
  },
  (a, b) => a.slice === b.slice && a.line === b.line,
);

// Elements

type WithNode<T extends keyof React.JSX.IntrinsicElements> = ComponentProps<T> & { node?: Element };

function textOf(node: ElementContent | Element): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(textOf).join('');
  return '';
}

const classesOf = (node: Element | undefined): string[] => {
  const value = node?.properties.className;
  return Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : [];
};

function Pre({ node, children, ...props }: WithNode<'pre'>) {
  const code = node?.children.find(
    (c): c is Element => c.type === 'element' && c.tagName === 'code',
  );
  const classes = classesOf(code);
  const line = props['data-line' as keyof typeof props] as number | undefined;
  if (code && classes.includes('math-display')) {
    return <MathView tex={textOf(code)} display line={line} />;
  }
  const language = classes.find((c) => c.startsWith('language-'))?.slice('language-'.length);
  if (code && language === 'mermaid') return <Mermaid code={textOf(code)} line={line} />;
  if (code)
    return <CodeBlock code={textOf(code).replace(/\n$/, '')} language={language} line={line} />;
  return <pre {...props}>{children}</pre>;
}

function InlineCode({ node, children, ...props }: WithNode<'code'>) {
  if (classesOf(node).includes('math-inline')) return <MathView tex={textOf(node!)} />;
  return <code {...props}>{children}</code>;
}

function CodeBlock({ code, language, line }: { code: string; language?: string; line?: number }) {
  const [html, setHtml] = useState<ReactNode>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!language) return;
    let live = true;
    highlight(code, language)
      .then((tree) => {
        if (!live || !tree) return;
        const pre = tree.children[0];
        // Only the highlighted lines: the frame is ours.
        const inner =
          pre?.type === 'element' ? (pre.children[0] as Element | undefined) : undefined;
        if (inner) setHtml(toJsxRuntime(inner, { Fragment, jsx, jsxs }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [code, language]);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="code-block" data-line={line}>
      {language && <span className="code-language">{language}</span>}
      <button
        type="button"
        className="code-copy"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        title={copied ? 'Copied' : 'Copy code'}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </button>
      <pre className={cn(html ? 'shiki' : undefined)}>{html ?? <code>{code}</code>}</pre>
    </div>
  );
}

function MathView({
  tex,
  display = false,
  line,
}: {
  tex: string;
  display?: boolean;
  line?: number;
}) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    import('./math')
      .then(({ renderMath }) => renderMath(tex, display))
      .then((result) => live && setHtml(result))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tex, display]);
  const Tag = display ? 'div' : 'span';
  if (html === null) {
    return (
      <Tag className={display ? 'math math-display' : 'math math-inline'} data-line={line}>
        <code>{tex}</code>
      </Tag>
    );
  }
  return (
    <Tag
      className={display ? 'math math-display' : 'math math-inline'}
      data-line={line}
      // KaTeX output, made without `trust`: it escapes everything it doesn't typeset.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Mermaid({ code, line }: { code: string; line?: number }) {
  const edit = useContext(DiagramContext);
  return (
    <div className="mermaid-diagram" data-line={line}>
      <DrawnDiagram
        code={code}
        failed={(message) => (
          <div className="code-block">
            <p className="mermaid-error">Diagram: {message}</p>
            <pre>
              <code>{code}</code>
            </pre>
          </div>
        )}
      />
      {edit && line !== undefined && (
        <button type="button" className="diagram-edit" onClick={() => edit(line)}>
          <PenLine aria-hidden /> Edit diagram
        </button>
      )}
    </div>
  );
}

function PreviewImage({ node: _node, src, alt, title, ...props }: WithNode<'img'>) {
  const url = useFileSrc(typeof src === 'string' ? src : undefined);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="image-button"
        onClick={() => setOpen(true)}
        aria-label={alt ? `Open image: ${alt}` : 'Open image'}
      >
        <img {...props} src={url} alt={alt ?? ''} title={title} loading="lazy" />
      </button>
      <ImageViewer
        open={open}
        onOpenChange={setOpen}
        url={url}
        alt={alt ?? ''}
        title={title ?? undefined}
      />
    </>
  );
}

function PreviewLink({ node: _node, href = '', children, className, ...props }: WithNode<'a'>) {
  const host = usePreviewHost();
  const knownCards = useCardKeys((s) => s.keys);
  const fileHref = useFileSrc(href.startsWith(ASSET_SCHEME) ? href : undefined);
  if (href.startsWith('wiki:')) {
    const [title = '', heading] = href.slice('wiki:'.length).split('#');
    const name = decodeURIComponent(title);
    const page = name ? host.findPage(name) : null;
    if (!page) {
      return (
        <span
          className={cn(className, 'wiki-link-missing')}
          title={`No page is called “${name}” yet`}
        >
          {children}
        </span>
      );
    }
    return (
      <PageHoverCard summary={host.summary?.(page.id) ?? null}>
        <a
          {...props}
          href={`/p/${page.id}`}
          className={className}
          data-heading={heading ? decodeURIComponent(heading) : undefined}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            host.openPage(page.id);
          }}
        >
          {children}
        </a>
      </PageHoverCard>
    );
  }
  if (href.startsWith('card:')) {
    const key = href.slice('card:'.length);
    if (!knownCards.has(key.slice(0, key.lastIndexOf('-')))) return <>{children}</>;
    return (
      <a
        {...props}
        href={`#${key}`}
        className={className}
        onClick={(e) => {
          e.preventDefault();
          openCardKey(key);
        }}
      >
        {children}
      </a>
    );
  }
  if (href.startsWith(ASSET_SCHEME)) {
    return (
      <a {...props} href={fileHref} className={cn(className, 'file-link')} download>
        {children}
      </a>
    );
  }
  if (href.startsWith('#')) {
    return (
      <a
        {...props}
        href={href}
        className={className}
        onClick={(e) => {
          // Footnotes: scroll within the page, without touching the address.
          // Ids in the page are prefixed (user-content-) so they can't clash with the app's.
          e.preventDefault();
          const id = decodeURIComponent(href.slice(1));
          const body = e.currentTarget.closest('.markdown-body');
          const target =
            body?.querySelector(`[id="${CSS.escape(`user-content-${id}`)}"]`) ??
            body?.querySelector(`[id="${CSS.escape(id)}"]`);
          target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <a
      {...props}
      href={href}
      className={className}
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      {children}
    </a>
  );
}

function TaskBox({ node, ...props }: WithNode<'input'>) {
  const toggle = useContext(TaskContext);
  const line = node?.properties.dataLine as number | undefined;
  // Ticks at once; the page's text follows, and the next rendering agrees.
  const [checked, setChecked] = useState(!!props.checked);
  const [rendered, setRendered] = useState(!!props.checked);
  if (rendered !== !!props.checked) {
    setRendered(!!props.checked);
    setChecked(!!props.checked);
  }
  if (props.type !== 'checkbox') return <input {...props} />;
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={!toggle || !line}
      aria-label={checked ? 'Done' : 'Not done'}
      onChange={() => {
        if (!line || !toggle) return;
        setChecked(!checked);
        toggle(line);
      }}
      className="task-box"
    />
  );
}

const components: Partial<Components> = {
  pre: Pre,
  code: InlineCode,
  img: PreviewImage,
  a: PreviewLink,
  input: TaskBox,
};
