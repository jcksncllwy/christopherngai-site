/// <reference types="@webgpu/types" />

declare module "*.avif" {
  const src: import("next/image").StaticImageData;
  export default src;
}
