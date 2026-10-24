import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// iOS Safari only applies :active (the button press animation) when the page listens for touches.
document.addEventListener("touchstart", () => {}, { passive: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
