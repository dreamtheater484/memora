import { useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import { toast } from '../components/ui';
import { errorMessage } from '../lib/api';
import { treeKey } from '../notes/keys';
import { useNotes } from '../notes/queries';
import { ARCHIVE_FILES, PAGE_FILES, importPageFiles } from './importFiles';
import { startImport } from './jobs';

/*
 * Files dropped from the computer onto the page list or a section tab (§9.10): pages for
 * that section, or an archive imported into its notebook. Moving pages and sections around
 * uses pointer events (lib/dnd), so the two never meet.
 */

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

export function useFileDrop(
  sectionOf: (e: DragEvent) => string | null,
  open: (pageId: string) => void,
) {
  const index = useNotes();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<string | null>(null);

  const importFiles = async (files: File[], sectionId: string) => {
    const section = index.section.get(sectionId);
    if (!section) return;
    const others = files.filter((f) => !PAGE_FILES.test(f.name) && !ARCHIVE_FILES.test(f.name));
    if (others.length) {
      toast({ title: `Memora can’t import “${others[0]!.name}”`, tone: 'error' });
    }
    for (const file of files.filter((f) => ARCHIVE_FILES.test(f.name))) {
      try {
        await startImport(file, section.notebookId ? { notebookId: section.notebookId } : {});
      } catch (error) {
        toast({ title: errorMessage(error), tone: 'error' });
      }
    }
    const pages = files.filter((f) => PAGE_FILES.test(f.name));
    if (!pages.length) return;
    const result = await importPageFiles(pages, sectionId);
    await queryClient.invalidateQueries({ queryKey: treeKey });
    const first = result.pageIds[0];
    if (first) {
      toast({
        title:
          result.pageIds.length === 1
            ? 'Imported 1 page'
            : `Imported ${result.pageIds.length} pages`,
        description: `Into ${section.name}`,
        tone: 'success',
        action: { label: 'Open', onClick: () => open(first) },
      });
    }
    for (const failed of result.failed) {
      toast({
        title: `Couldn’t import “${failed.name}”`,
        description: failed.reason,
        tone: 'error',
      });
    }
  };

  const handlers = {
    onDragOver(e: DragEvent) {
      if (!hasFiles(e)) return;
      const section = sectionOf(e);
      setTarget(section);
      if (!section) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave(e: DragEvent) {
      if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) setTarget(null);
    },
    onDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      const section = sectionOf(e);
      setTarget(null);
      if (!section) return;
      e.preventDefault();
      void importFiles([...e.dataTransfer.files], section);
    },
  };
  return { target, handlers };
}
