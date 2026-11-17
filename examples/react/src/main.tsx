import "@jayalfredprufrock/ansel/styles.css";
import { Img } from "@jayalfredprufrock/ansel/react";
import { createRoot } from "react-dom/client";
import drPatel from "./images/team/dr-patel.jpg?ansel";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <>
      <h1>ansel: React example</h1>
      <Img image={drPatel} ratio="4:3" sizes="(min-width: 40rem) 40rem, 100vw" priority />
    </>,
  );
}
