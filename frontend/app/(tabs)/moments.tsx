// Moments is now a primary bottom-tab (Wave B). The full feed screen lives
// in src/screens so it can sit inside the (tabs) group without a route
// conflict with the old /moments/index route. Detail (/moments/[id]) and
// composer (/moments/new) remain separate stack routes.
export { default } from "@/src/screens/MomentsScreen";
