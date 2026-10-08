import { ComponentNode } from "./ComponentNode";
import { GhostNode } from "./GhostNode";
import { InstanceNode } from "./InstanceNode";
import { TextNode } from "./TextNode";

export const nodeTypes = {
  component: ComponentNode,
  text: TextNode,
  ghost: GhostNode,
  instance: InstanceNode,
};
