"use client";

import { useRouter } from "next/navigation";

export function SairButton() {
  const router = useRouter();

  async function sair(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={() => void sair()}
      style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--texto-suave)", cursor: "pointer", fontSize: 13 }}
    >
      Sair
    </button>
  );
}
