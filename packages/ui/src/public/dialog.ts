import { Dialog as Root, DialogTitleGroup } from "../components/dialog"

export { DialogBody, DialogFooter, DialogHeader, DialogTitle } from "../components/dialog"
export type { DialogProps } from "../components/dialog"
export const Dialog = Object.assign(Root, { TitleGroup: DialogTitleGroup })
export namespace Dialog {
  export type Props = import("../components/dialog").DialogProps
  export type HeaderProps = import("../components/dialog").DialogHeaderProps
  export type TitleProps = import("../components/dialog").DialogTitleGroupProps
}
