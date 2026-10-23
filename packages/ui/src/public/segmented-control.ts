import { SegmentedControl as Root, SegmentedControlItem } from "../components/segmented-control"

export const SegmentedControl = Object.assign(Root, { Item: SegmentedControlItem })
export namespace SegmentedControl {
  export type Props = import("../components/segmented-control").SegmentedControlProps
  export type ItemProps = import("../components/segmented-control").SegmentedControlItemProps
}
