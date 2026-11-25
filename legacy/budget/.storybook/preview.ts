import type { Preview } from "@storybook/react-vite";

import "../../../packs/budget/pack/src/renderer/theme/styles.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
