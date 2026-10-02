/** Central list for the workspace tab bar — add entries here when introducing new tabs. */
export const TABS = [
  { path: "/overview", label: "Live" },
  { path: "/reel", label: "Review Reel" },
] as const;

export type TabConfig = (typeof TABS)[number];
