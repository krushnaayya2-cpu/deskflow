import { createRoot } from "react-dom/client";
import Convert from "./Convert";
import DropZone from "./DropZone";
import "./convert.css";

const isDropZone = window.location.search.includes("dropzone");
createRoot(document.getElementById("root")!).render(isDropZone ? <DropZone /> : <Convert />);
