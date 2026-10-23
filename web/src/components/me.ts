import { createContext } from "react";

/**
 * Name of the member currently speaking (the "As ..." picker). Request cards use it to show
 * pay / confirm actions only to the people involved. Own module so hot reloads keep one context.
 */
export const MeContext = createContext<string | null>(null);
export const MeProvider = MeContext.Provider;
