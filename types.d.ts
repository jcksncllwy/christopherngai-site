declare module "*.avif" {
  const src: import("next/image").StaticImageData;
  export default src;
}
