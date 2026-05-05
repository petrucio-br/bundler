// Persistent app footer used on the landing page and inside the dashboard sidebar.
// Three lines: dev credit, source link, current-game link.
// Kept small and quiet so it sits in the corner without competing with content.

export function Footer() {
  return (
    <footer className="text-xs text-white/30 space-y-1.5 leading-relaxed">
      <div>
        Built by{" "}
        <a
          href="https://x.com/PetrucioBR"
          target="_blank"
          rel="noreferrer"
          className="hover:text-white/70 underline underline-offset-2"
        >
          Petrucio
        </a>
        {" "}of{" "}
        <a
          href="https://x.com/LonePiggyGames"
          target="_blank"
          rel="noreferrer"
          className="hover:text-white/70 underline underline-offset-2"
        >
          Lone Piggy
        </a>
      </div>
      <div>
        <a
          href="https://github.com/petrucio-br/bundler"
          target="_blank"
          rel="noreferrer"
          className="hover:text-white/70 underline underline-offset-2"
        >
          Open source on GitHub
        </a>
      </div>
      <div>
        Also making{" "}
        <a
          href="https://store.steampowered.com/app/4641550"
          target="_blank"
          rel="noreferrer"
          className="hover:text-white/70 underline underline-offset-2"
        >
          Kegs of Eternity
        </a>
      </div>
    </footer>
  );
}
