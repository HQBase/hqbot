import type * as React from "react";
import type { ToasterProps } from "sonner";
import { Toaster as Sonner } from "sonner";

import { useTheme } from "../../features/theme/theme-provider";

export function Toaster(props: ToasterProps): React.ReactElement {
  const { theme } = useTheme();
  return <Sonner closeButton richColors theme={theme} {...props} />;
}
