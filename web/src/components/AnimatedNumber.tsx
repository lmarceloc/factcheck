import { motion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";

export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const spring = useSpring(value, { stiffness: 180, damping: 26 });
  const text = useTransform(spring, (v) => Math.round(v).toString());
  useEffect(() => spring.set(value), [spring, value]);
  return <motion.span className={className}>{text}</motion.span>;
}
