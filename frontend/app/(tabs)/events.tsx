// Events is now a primary bottom-tab (Wave B). The full list screen lives in
// src/screens so it can sit inside the (tabs) group without a route conflict
// with the old /events route. Composer (/events/new) and editor
// (/events/edit) remain separate stack routes.
export { default } from "@/src/screens/EventsScreen";
