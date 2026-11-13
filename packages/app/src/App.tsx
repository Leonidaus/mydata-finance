import Chat from "./Chat";

const BASKETS = [
  { title: "Must-pay, regular", example: "Rent, electricity, phone" },
  { title: "Must-pay, irregular", example: "A broken washing machine" },
  { title: "Slips through fingers", example: "Coffees, takeaways, impulse buys" },
];

export default function App() {
  return (
    <div className="page">
      <header className="hero">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">€</span>
          <span>MyData Finance</span>
        </div>
        <h1>Talk with your own money</h1>
        <p className="lede">
          Ask anything about your spending in plain language. Your data stays on
          your device, and every answer shows how it was calculated.
        </p>
      </header>

      <main className="content">
        <Chat />

        <section className="baskets" aria-labelledby="baskets-title">
          <h2 id="baskets-title">Where does your money go?</h2>
          <p className="muted">Every euro you spend lands in one of three baskets.</p>
          <ul>
            {BASKETS.map((b, i) => (
              <li key={b.title} className={`basket basket-${i + 1}`}>
                <strong>{b.title}</strong>
                <span>{b.example}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="footer muted">Junction 2026 · S-Bank challenge prototype · synthetic data</footer>
    </div>
  );
}
