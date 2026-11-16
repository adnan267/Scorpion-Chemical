import React from 'react';

import { Card, T } from '@/ui/kit';
import { C } from '@/ui/theme';

/** Excel files are handled on the web panel; phones only get a pointer to it. */
export function ExcelImport() {
  return (
    <Card style={{ gap: 6 }}>
      <T v="strong">Use the web panel for Excel</T>
      <T color={C.sub}>Open the Scorpion Chemical web panel on a computer, sign in as admin, and go to More, Opening data, Import from Excel. You can download the template there, fill it in, and upload it.</T>
    </Card>
  );
}
