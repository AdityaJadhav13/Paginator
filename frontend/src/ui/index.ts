/**
 * Pageinator durable UI foundation — public export surface.
 *
 * Only durable foundation code is exported here.
 * Demo fixtures, showcase components, and test helpers are NOT exported.
 *
 * Contracts:
 * @see ./contracts/presentation-state.ts
 *
 * Layout primitives:
 * @see ./layout/
 *
 * Foundational controls:
 * @see ./controls/
 */

// Contracts
export type { PresentationState, StatusIndicatorProps } from "./contracts/presentation-state.ts";

// Layout primitives
export { Stack } from "./layout/Stack.tsx";
export type { SpaceToken } from "./layout/Stack.tsx";
export { Inline } from "./layout/Inline.tsx";
export { Cluster } from "./layout/Cluster.tsx";
export { Grid } from "./layout/Grid.tsx";
export { Container } from "./layout/Container.tsx";
export { Surface } from "./layout/Surface.tsx";
export { VisuallyHidden } from "./layout/VisuallyHidden.tsx";

// Controls
export { Button } from "./controls/Button.tsx";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./controls/Button.tsx";
export { IconButton } from "./controls/IconButton.tsx";
export type { IconButtonProps } from "./controls/IconButton.tsx";
export { Field } from "./controls/Field.tsx";
export type { FieldProps } from "./controls/Field.tsx";
export { TextInput } from "./controls/TextInput.tsx";
export type { TextInputProps } from "./controls/TextInput.tsx";
export { TextArea } from "./controls/TextArea.tsx";
export type { TextAreaProps } from "./controls/TextArea.tsx";
export { Select } from "./controls/Select.tsx";
export type { SelectProps } from "./controls/Select.tsx";
export { Checkbox } from "./controls/Checkbox.tsx";
export type { CheckboxProps } from "./controls/Checkbox.tsx";
export { RadioGroup } from "./controls/RadioGroup.tsx";
export type { RadioGroupProps, RadioOption } from "./controls/RadioGroup.tsx";
export { Dialog } from "./controls/Dialog.tsx";
export type { DialogProps } from "./controls/Dialog.tsx";
export { InlineMessage } from "./controls/InlineMessage.tsx";
export type { InlineMessageProps, InlineMessageVariant } from "./controls/InlineMessage.tsx";
export { StatusIndicator } from "./controls/StatusIndicator.tsx";
export { ProgressIndicator } from "./controls/ProgressIndicator.tsx";
export type { ProgressIndicatorProps } from "./controls/ProgressIndicator.tsx";
