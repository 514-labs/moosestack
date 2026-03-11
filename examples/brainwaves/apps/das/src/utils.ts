export function pcap(value: number): number {
  let num = parseFloat(`${value}`);
  return Number(num.toFixed(6));
}
