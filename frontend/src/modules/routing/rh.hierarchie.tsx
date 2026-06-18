import { createFileRoute } from "@tanstack/react-router";
import { RhHierarchy } from "@/modules/rh/hierarchy/hierarchy.page";

export const Route = createFileRoute("/rh/hierarchie")({
  component: RhHierarchy,
  head: () => ({ meta: [{ title: "Hierarchie RH · upOwa" }] }),
});
