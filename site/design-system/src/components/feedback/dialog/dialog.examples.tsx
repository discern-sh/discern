import { useState } from "react";
import { Button } from "../../core/button/button.tsx";
import { Input } from "../../forms/input/input.tsx";
import { Dialog } from "./dialog.tsx";
export default function DialogExamples() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        kicker="Example"
        title="Lorem ipsum dolor"
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Continue</Button>
          </>
        }
      >
        <Input label="Lorem ipsum" placeholder="Dolor sit amet" />
      </Dialog>
    </>
  );
}
