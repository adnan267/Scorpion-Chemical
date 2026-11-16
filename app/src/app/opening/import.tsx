import React from 'react';

import { ExcelImport } from '@/ui/ExcelImport';
import { Screen } from '@/ui/Shell';

export default function ImportOpening() {
  return (
    <Screen title="Import from Excel" back="/opening">
      <ExcelImport />
    </Screen>
  );
}
