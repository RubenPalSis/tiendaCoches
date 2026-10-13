const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto para insertarlo de forma segura en HTML (contenido y atributos). */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => MAP[c]);
}

/** Template tag: escapa todas las interpolaciones salvo las marcadas con raw(). */
export function html(strings, ...values) {
  return strings.reduce((out, str, i) => {
    if (i >= values.length) return out + str;
    const v = values[i];
    const rendered = Array.isArray(v)
      ? v.map((x) => (x instanceof Raw ? x.value : esc(x))).join('')
      : v instanceof Raw ? v.value : v === false || v == null ? '' : esc(v);
    return out + str + rendered;
  }, '');
}

class Raw {
  constructor(value) { this.value = value; }
}

/** Marca HTML ya seguro (generado por nosotros) para no escaparlo de nuevo. */
export function raw(value) {
  return new Raw(String(value ?? ''));
}
