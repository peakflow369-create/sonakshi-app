// Colours come from CSS variables (see src/input.css) so one class works in both themes.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        void: v("void"),     // page background
        panel: v("panel"),   // drawer + dialog surface
        ink: v("ink"),       // primary text
        haze: v("haze"),     // secondary text
        arc: v("arc"),       // brand cyan
        ember: v("ember"),   // thinking / alerts
        bloom: v("bloom"),   // Sonakshi's pink: Bible verse + speaking
      },
    },
  },
};
