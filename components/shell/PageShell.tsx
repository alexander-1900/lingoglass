"use client";

import { useState } from "react";
import Sidebar from "./Sidebar";

const KEY = "lingoglass:sidebar";

function readPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

/** App grid: collapsible sidebar + page content. Routes/params untouched. */
export default function PageShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<boolean>(readPref);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div className={`lg-shell${open ? "" : " collapsed"}`}>
      <Sidebar open={open} onToggle={toggle} />
      <div className="lg-main">{children}</div>
    </div>
  );
}
