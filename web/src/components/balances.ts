import { createContext } from "react";

/**
 * Live net balance per member name (cents). Lets split rows show who has settled up.
 * Kept in its own module so hot-reloading Cards.tsx doesn't create a second context.
 */
export const BalancesContext = createContext<Map<string, number>>(new Map());
export const BalancesProvider = BalancesContext.Provider;
