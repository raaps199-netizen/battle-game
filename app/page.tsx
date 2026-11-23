"use client";

import Link from "next/link";

export default function GameHub() {
  return (
    <main className="hub-page">
      <header className="hub-topbar">
        <Link href="/" className="hub-brand">GOHOFog<span>•</span></Link>
        <div className="hub-nav">
          <span className="hub-nav-active">GAMES</span>
        </div>
      </header>
      <section className="hub-hero">
        <div className="hub-hero-copy">
          <div className="hub-overline"><span /> THE GAME LOBBY</div>
          <h1>Pick a game.<br /><em>Make a night of it.</em></h1>
          <p>One place for games with friends. Choose a game and get straight into the action.</p>
        </div>
        <div className="hub-hero-mark" aria-hidden="true">
          <div className="hub-orbit orbit-one" />
          <div className="hub-orbit orbit-two" />
          <div className="hub-moon">☾</div>
          <span className="hub-mark-star star-one">✦</span>
          <span className="hub-mark-star star-two">✧</span>
        </div>
      </section>
      <section className="hub-library">
        <div className="hub-section-head">
          <div><span className="hub-section-kicker">THE LIBRARY</span><h2>Games <span>01</span></h2></div>
          <span className="hub-section-note">CHOOSE YOUR NEXT MATCH</span>
        </div>
        <div className="hub-game-grid">
          <Link href="/games/werewolf" className="hub-game-card">
            <div className="hub-card-art werewolf-art">
              <div className="werewolf-art-glow" /><div className="werewolf-art-moon">☾</div>
              <div className="werewolf-art-tree tree-left" /><div className="werewolf-art-tree tree-right" />
              <div className="werewolf-silhouette">♟</div>
              <span className="hub-card-index">01 / SOCIAL DEDUCTION</span>
              <span className="hub-card-play">PLAY <b>↗</b></span>
            </div>
            <div className="hub-card-info">
              <div><span className="hub-card-tag"><i /> AVAILABLE NOW</span><h3>Werewolf</h3><p>Read the room. Find the liar. Survive the night.</p></div>
              <span className="hub-card-arrow">↗</span>
            </div>
          </Link>
          <div className="hub-coming-card">
            <div className="hub-coming-symbol">＋</div>
            <span>MORE GAMES</span>
            <strong>Something new<br />is coming.</strong>
            <p>The library will grow from here.</p>
            <div className="hub-coming-line" />
          </div>
        </div>
      </section>
      <footer className="hub-footer"><span>PLAY TOGETHER. THINK DIFFERENTLY.</span></footer>
    </main>
  );
}
