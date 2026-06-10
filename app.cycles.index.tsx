import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/app/cycles/$id")({
  component: () => <Outlet />,
});
