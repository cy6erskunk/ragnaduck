import { neon } from '@neondatabase/serverless';

let impl;

/** Tagged-template query that resolves to an array of rows. */
export function sql(strings, ...values) {
  impl ??= neon(process.env.DATABASE_URL);
  return impl(strings, ...values);
}

/** Tests swap in a local Postgres. */
export function setSqlForTests(fn) {
  impl = fn;
}
