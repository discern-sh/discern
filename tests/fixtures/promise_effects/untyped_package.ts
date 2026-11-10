import { useEffect, useState } from "react";

export function useFixture(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(1);
    Promise.resolve(count);
  }, [count]);
  return count;
}
