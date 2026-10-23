import { defineMeta } from "blume"

export default defineMeta({
  title: "Deploy",
  icon: "cloud-upload",
  order: 8,
  pages: ["aws", "aws-resources", "aws-permissions", "azure", "entra"],
})
