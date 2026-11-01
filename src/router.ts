import { useEffect, useState } from "react";

export function navigate(path: string): void {
  window.location.hash = path;
}

function currentPath(): string {
  return window.location.hash.replace(/^#/, "") || "/";
}

export function useRoute(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => {
      setPath(currentPath());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return path;
}
