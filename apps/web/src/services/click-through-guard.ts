interface ClickTarget {
  readonly isConnected: boolean;
}
interface Activation<T extends ClickTarget> {
  target: T;
  detail: number;
  timeStamp: number;
  clientX: number;
  clientY: number;
}

/** Block only a repeated click falling through a control that disappeared. */
export function createClickThroughGuard<T extends ClickTarget>() {
  let previous: Activation<T> | undefined;
  return (activation: Activation<T>): boolean => {
    if (activation.detail === 0) return false;
    const elapsed = previous ? activation.timeStamp - previous.timeStamp : 0;
    if (
      activation.detail > 1 &&
      previous &&
      previous.target !== activation.target &&
      !previous.target.isConnected &&
      elapsed >= 0 &&
      elapsed <= 650 &&
      Math.hypot(
        activation.clientX - previous.clientX,
        activation.clientY - previous.clientY,
      ) <= 6
    )
      return true;
    previous = activation;
    return false;
  };
}
