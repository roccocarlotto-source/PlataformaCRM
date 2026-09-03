// Iniciales para Avatar.tsx. Vive en su propio módulo (y no dentro de
// Avatar.tsx) por dos motivos: es lógica pura testeable sin DOM, y
// react-refresh avisa cuando un módulo exporta un componente junto a algo que
// no lo es.
//
// Regla: primera letra de la primera palabra + primera letra de la ÚLTIMA
// palabra, en mayúsculas. Es lo que muestra el diseño ("Rocco Carlotto" →
// "RC", "María Cabrera" → "MC") y funciona igual para nombres compuestos
// ("Juan Pablo de la Cruz" → "JC") sin tener que adivinar qué palabra es el
// apellido. Un solo nombre da una sola letra ("Rocco" → "R"). Vacío da "".
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  const first = firstLetter(words[0]);
  if (words.length === 1) return first;
  return first + firstLetter(words[words.length - 1]);
}

// Array.from respeta code points: una inicial con acento o fuera del BMP no se
// parte por la mitad como haría name[0].
function firstLetter(word: string): string {
  return (Array.from(word)[0] ?? "").toLocaleUpperCase();
}
