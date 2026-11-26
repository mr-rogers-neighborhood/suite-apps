import * as Checkbox from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

type TaskCheckboxProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
};

export function TaskCheckbox({ checked, onCheckedChange, label }: TaskCheckboxProps) {
  return (
    <Checkbox.Root
      checked={checked}
      onCheckedChange={(value) => onCheckedChange(value === true)}
      aria-label={label}
      className="group mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white transition-colors touch sm:h-[18px] sm:w-[18px]"
    >
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border border-line bg-panel transition-colors group-data-[state=checked]:border-accent group-data-[state=checked]:bg-accent">
        <Checkbox.Indicator>
          <Check size={12} strokeWidth={3} />
        </Checkbox.Indicator>
      </span>
    </Checkbox.Root>
  );
}
