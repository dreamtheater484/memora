import type { ProjectIcon } from '@memora/shared';
import {
  Briefcase,
  Code,
  GraduationCap,
  Heart,
  House,
  Leaf,
  Megaphone,
  Palette,
  Rocket,
  SquareKanban,
  Star,
  Wrench,
} from 'lucide-react';
import type { ReactNode } from 'react';

/** The icons a project can have. */
export const PROJECT_ICON: Record<ProjectIcon, ReactNode> = {
  'square-kanban': <SquareKanban />,
  rocket: <Rocket />,
  code: <Code />,
  palette: <Palette />,
  megaphone: <Megaphone />,
  briefcase: <Briefcase />,
  house: <House />,
  leaf: <Leaf />,
  'graduation-cap': <GraduationCap />,
  wrench: <Wrench />,
  heart: <Heart />,
  star: <Star />,
};
