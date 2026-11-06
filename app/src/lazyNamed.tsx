import { Suspense, lazy, type ComponentProps, type ComponentType } from 'react';

/**
 * Lazy-load one named export and give it its own Suspense boundary with no
 * fallback, so loading one drawer never hides another that is already open
 * and nothing on screen moves while the chunk arrives.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<M extends Record<K, ComponentType<any>>, K extends keyof M & string>(load: () => Promise<M>, name: K) {
  const Lazy = lazy(async () => ({ default: (await load())[name] }));
  return function LazyNamed(props: ComponentProps<M[K]>) {
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
