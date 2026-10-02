// Sketch of `pf/no-number-money` (TC-PLATFORM-ARCH-002, ADR-0006): typed rule
// built on typescript-eslint. Flags money-named fields/params whose RESOLVED
// type includes `number` (so `type Amount = number` aliases are caught too),
// and `.toNumber()` calls on decimal.js values.
import { ESLintUtils } from '@typescript-eslint/utils';
import ts from 'typescript';

const MONEY_NAME =
  /^(amount|balance|price|fee|total|rate|subtotal|principal|interest)$|(Amount|Balance|Price|Fee|Total|Rate|Principal|Interest)$/;

const createRule = ESLintUtils.RuleCreator((name) => `https://pfos.local/lint/${name}`);

function includesNumber(type) {
  if (type.isUnion()) return type.types.some(includesNumber);
  return (type.flags & ts.TypeFlags.NumberLike) !== 0;
}

export const noNumberMoney = createRule({
  name: 'no-number-money',
  meta: {
    type: 'problem',
    docs: { description: 'Money/rate values must be Money, Decimal or decimal strings, never number' },
    messages: {
      numberField: '"{{name}}" looks like money/rate but its type includes number. Use Money, Decimal or a decimal string (ADR-0006).',
      toNumber: 'Do not convert a decimal to number (ADR-0006, INV-001).',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    function check(node, name, typeNode) {
      if (!name || !typeNode || !MONEY_NAME.test(name)) return;
      const type = services.getTypeAtLocation(typeNode);
      if (includesNumber(type)) context.report({ node, messageId: 'numberField', data: { name } });
    }

    return {
      TSPropertySignature(node) {
        if (node.key.type === 'Identifier') check(node, node.key.name, node.typeAnnotation?.typeAnnotation);
      },
      PropertyDefinition(node) {
        if (node.key.type === 'Identifier') check(node, node.key.name, node.typeAnnotation?.typeAnnotation ?? node.value);
      },
      'FunctionDeclaration, FunctionExpression, ArrowFunctionExpression, TSMethodSignature'(node) {
        for (const p of node.params) {
          if (p.type === 'Identifier') check(p, p.name, p.typeAnnotation?.typeAnnotation);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return;
        if (callee.property.name !== 'toNumber') return;
        const objType = checker.getApparentType(services.getTypeAtLocation(callee.object));
        const symbolName = objType.getSymbol()?.getName();
        if (symbolName === 'Decimal' || symbolName === 'Big' || symbolName === 'Money') {
          context.report({ node, messageId: 'toNumber' });
        }
      },
    };
  },
});

export default { rules: { 'no-number-money': noNumberMoney } };
