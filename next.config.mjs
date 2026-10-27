/** @type {import('next').NextConfig} */
const nextConfig = {
  // keep the native ONNX runtime out of the webpack bundle
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp", "pg"],
};
export default nextConfig;
