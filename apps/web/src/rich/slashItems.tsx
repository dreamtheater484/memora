import type { Editor, Range } from '@tiptap/core';
import {
  Calendar,
  CheckSquare,
  Code2,
  FileUp,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Info,
  Link2,
  List,
  ListOrdered,
  Minus,
  Network,
  Pilcrow,
  Quote,
  Sigma,
  Table,
  TriangleAlert,
} from 'lucide-react';
import { insertFiles } from './files';
import type { RichHost } from './host';
import type { MenuItem } from './suggestions';

/*
 * What `/` offers in a rich page (§9.4): the blocks of the Insert tab, found by typing.
 */

const run =
  (apply: (editor: Editor) => void) =>
  (editor: Editor, range: Range): void => {
    editor.chain().focus().deleteRange(range).run();
    apply(editor);
  };

export function slashItems(host: RichHost): MenuItem[] {
  return [
    {
      title: 'Text',
      keywords: 'paragraph plain',
      icon: <Pilcrow />,
      run: run((e) => e.chain().focus().setParagraph().run()),
    },
    {
      title: 'Heading 1',
      keywords: 'title h1',
      icon: <Heading1 />,
      run: run((e) => e.chain().focus().setHeading({ level: 1 }).run()),
    },
    {
      title: 'Heading 2',
      keywords: 'subtitle h2',
      icon: <Heading2 />,
      run: run((e) => e.chain().focus().setHeading({ level: 2 }).run()),
    },
    {
      title: 'Heading 3',
      keywords: 'h3',
      icon: <Heading3 />,
      run: run((e) => e.chain().focus().setHeading({ level: 3 }).run()),
    },
    {
      title: 'Bullet list',
      keywords: 'unordered ul',
      icon: <List />,
      run: run((e) => e.chain().focus().toggleBulletList().run()),
    },
    {
      title: 'Numbered list',
      keywords: 'ordered ol',
      icon: <ListOrdered />,
      run: run((e) => e.chain().focus().toggleOrderedList().run()),
    },
    {
      title: 'Task list',
      keywords: 'todo checkbox',
      icon: <CheckSquare />,
      run: run((e) => e.chain().focus().toggleTaskList().run()),
    },
    {
      title: 'Quote',
      keywords: 'blockquote',
      icon: <Quote />,
      run: run((e) => e.chain().focus().toggleBlockquote().run()),
    },
    {
      title: 'Note box',
      keywords: 'callout info tip',
      icon: <Info />,
      run: run((e) => e.chain().focus().setCallout('note').run()),
    },
    {
      title: 'Warning box',
      keywords: 'callout caution',
      icon: <TriangleAlert />,
      run: run((e) => e.chain().focus().setCallout('warning').run()),
    },
    {
      title: 'Table',
      keywords: 'grid',
      icon: <Table />,
      run: run((e) =>
        e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      ),
    },
    {
      title: 'Code block',
      keywords: 'snippet pre',
      icon: <Code2 />,
      run: run((e) => e.chain().focus().toggleCodeBlock().run()),
    },
    {
      title: 'Diagram',
      keywords: 'mermaid flowchart',
      icon: <Network />,
      run: run((e) =>
        e
          .chain()
          .focus()
          .insertContent({
            type: 'codeBlock',
            attrs: { language: 'mermaid' },
            content: [{ type: 'text', text: 'flowchart LR\n  A --> B' }],
          })
          .run(),
      ),
    },
    {
      title: 'Formula',
      keywords: 'math latex equation katex',
      icon: <Sigma />,
      run: run(() => host.editMath({ pos: null, latex: '', inline: false })),
    },
    {
      title: 'Image',
      keywords: 'picture photo upload',
      icon: <ImagePlus />,
      run: run((e) => {
        void host.pickFiles(true).then((files) => insertFiles(e, files, host));
      }),
    },
    {
      title: 'File',
      keywords: 'attachment pdf upload',
      icon: <FileUp />,
      run: run((e) => {
        void host.pickFiles(false).then((files) => insertFiles(e, files, host));
      }),
    },
    {
      title: 'Link',
      keywords: 'url web',
      icon: <Link2 />,
      run: run(() => host.editLink()),
    },
    {
      title: 'Divider',
      keywords: 'rule line hr',
      icon: <Minus />,
      run: run((e) => e.chain().focus().setHorizontalRule().run()),
    },
    {
      title: 'Today’s date',
      keywords: 'date today now',
      icon: <Calendar />,
      run: run((e) =>
        e
          .chain()
          .focus()
          .insertContent(
            new Date().toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
          )
          .run(),
      ),
    },
  ];
}
