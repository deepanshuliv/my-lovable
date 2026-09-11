/**
 * A route handler exists in the template on purpose: it is the proof that this is a
 * fullstack starter, and the platform polls it to decide when the dev server is really
 * up rather than merely listening.
 */
export async function GET() {
  return Response.json({ ok: true, at: new Date().toISOString() });
}
