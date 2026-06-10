import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: ({ context: _ctx }) => {
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
