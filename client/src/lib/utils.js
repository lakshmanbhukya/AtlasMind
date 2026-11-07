import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Workspace id: the API returns `id`, stored documents use `_id`. */
export const workspaceId = (w) => w.id || w._id;
