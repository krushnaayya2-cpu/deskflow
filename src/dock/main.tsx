import { catchErrors } from "../lib/diag";
catchErrors();
import { createRoot } from "react-dom/client";
import Dock from "./Dock";
import "./dock.css";
import { glassSupported } from "../lib/island";
import { diag } from "../lib/diag";

diag(`dock page loaded ${window.innerWidth}x${window.innerHeight}`);

// Native acrylic missing (old Windows): glass.css switches to solid colours.
glassSupported()
  .then((ok) => (document.documentElement.dataset.glass = ok ? "native" : "none"))
  .catch(() => (document.documentElement.dataset.glass = "none"));

createRoot(document.getElementById("root")!).render(<Dock />);
