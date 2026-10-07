import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { REGION } from '../lib/config.js';
import { upsertProductInIndex, rebuildCategoriesInIndex } from './catalog-index.js';

export const onProductWritten = onDocumentWritten({ document: 'products/{productId}', region: REGION }, (event) =>
  upsertProductInIndex(event.params.productId),
);

export const onCategoryWritten = onDocumentWritten({ document: 'categories/{categoryId}', region: REGION }, () =>
  rebuildCategoriesInIndex(),
);
