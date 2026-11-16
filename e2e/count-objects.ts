import type { CDPSession } from '@playwright/test';

/**
 * The live objects of a prototype for which `test`, an expression of `node`, holds. `queryObjects` hands back an array
 * that DevTools keeps until its group is released, and a kept array keeps every node in
 * it, so a count that did not release it would itself hold each old page it counted.
 */
export async function countObjects(
  session: CDPSession,
  prototype: string,
  test: string,
): Promise<number> {
  const objectGroup = 'memory-bench-count';
  try {
    const { result } = await session.send('Runtime.evaluate', {
      expression: prototype,
      objectGroup,
    });
    const { objects } = await session.send('Runtime.queryObjects', {
      prototypeObjectId: result.objectId ?? '',
      objectGroup,
    });
    const counted = await session.send('Runtime.callFunctionOn', {
      objectId: objects.objectId ?? '',
      // Prototypes come back with the instances, and reading a node's fields from one throws.
      functionDeclaration: `function () {
        return this.filter((node) => {
          try { return typeof node.isConnected === 'boolean' && (${test}); } catch { return false; }
        }).length;
      }`,
      returnByValue: true,
    });
    return Number(counted.result.value);
  } finally {
    await session.send('Runtime.releaseObjectGroup', { objectGroup });
  }
}
