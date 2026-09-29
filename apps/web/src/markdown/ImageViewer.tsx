import { ExternalLink } from 'lucide-react';
import { Dialog, DialogContent } from '../components/ui';

/** An image at full size, in a dialog, with a link to the original. */
export function ImageViewer({
  open,
  onOpenChange,
  url,
  alt,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string | undefined;
  alt: string;
  title?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent size="xl" title={alt || 'Image'} description={title || undefined}>
          <img src={url} alt={alt} className="mx-auto max-h-[65dvh] max-w-full object-contain" />
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent underline [&_svg]:size-3.5"
            >
              Open the original <ExternalLink aria-hidden />
            </a>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
