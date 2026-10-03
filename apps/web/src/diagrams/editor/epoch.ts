import { createContext } from 'react';

/**
 * Goes up whenever the diagram changes other than by typing in a field (undo, redo, the code,
 * adding or moving): the panel's fields then take the diagram's words again (§9.4).
 */
export const EditEpoch = createContext(0);
