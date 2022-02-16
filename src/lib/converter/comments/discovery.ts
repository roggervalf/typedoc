import * as ts from "typescript";
import { ReflectionKind } from "../../models";
import type { Logger } from "../../utils";
import { nicePath } from "../../utils/paths";

// Note: This does NOT include JSDoc syntax kinds. This is important!
// Comments from @typedef and @callback tags are handled specially by
// the JSDoc converter because we only want part of the comment when
// getting them.
const wantedKinds: Record<ReflectionKind, ts.SyntaxKind[]> = {
    [ReflectionKind.Project]: [ts.SyntaxKind.SourceFile],
    [ReflectionKind.Module]: [ts.SyntaxKind.SourceFile],
    [ReflectionKind.Namespace]: [
        ts.SyntaxKind.ModuleDeclaration,
        ts.SyntaxKind.SourceFile,
        ts.SyntaxKind.BindingElement,
    ],
    [ReflectionKind.Enum]: [
        ts.SyntaxKind.EnumDeclaration,
        ts.SyntaxKind.VariableDeclaration,
    ],
    [ReflectionKind.EnumMember]: [
        ts.SyntaxKind.EnumMember,
        // This is here so that @enum gets it
        ts.SyntaxKind.PropertyAssignment,
    ],
    [ReflectionKind.Variable]: [
        ts.SyntaxKind.VariableDeclaration,
        ts.SyntaxKind.BindingElement,
    ],
    [ReflectionKind.Function]: [
        ts.SyntaxKind.FunctionDeclaration,
        ts.SyntaxKind.BindingElement,
    ],
    [ReflectionKind.Class]: [
        ts.SyntaxKind.ClassDeclaration,
        ts.SyntaxKind.BindingElement,
    ],
    [ReflectionKind.Interface]: [ts.SyntaxKind.InterfaceDeclaration],
    [ReflectionKind.Constructor]: [ts.SyntaxKind.Constructor],
    [ReflectionKind.Property]: [
        ts.SyntaxKind.PropertyDeclaration,
        ts.SyntaxKind.PropertySignature,
        ts.SyntaxKind.BinaryExpression,
    ],
    [ReflectionKind.Method]: [
        ts.SyntaxKind.FunctionDeclaration,
        ts.SyntaxKind.MethodDeclaration,
    ],
    [ReflectionKind.CallSignature]: [
        ts.SyntaxKind.FunctionDeclaration,
        ts.SyntaxKind.VariableDeclaration,
        ts.SyntaxKind.MethodDeclaration,
        ts.SyntaxKind.MethodDeclaration,
        ts.SyntaxKind.PropertyDeclaration,
        ts.SyntaxKind.PropertySignature,
        ts.SyntaxKind.CallSignature,
    ],
    [ReflectionKind.IndexSignature]: [ts.SyntaxKind.IndexSignature],
    [ReflectionKind.ConstructorSignature]: [ts.SyntaxKind.ConstructSignature],
    [ReflectionKind.Parameter]: [ts.SyntaxKind.Parameter],
    [ReflectionKind.TypeLiteral]: [ts.SyntaxKind.TypeLiteral],
    [ReflectionKind.TypeParameter]: [ts.SyntaxKind.TypeParameter],
    [ReflectionKind.Accessor]: [
        ts.SyntaxKind.GetAccessor,
        ts.SyntaxKind.SetAccessor,
    ],
    [ReflectionKind.GetSignature]: [ts.SyntaxKind.GetAccessor],
    [ReflectionKind.SetSignature]: [ts.SyntaxKind.SetAccessor],
    [ReflectionKind.ObjectLiteral]: [ts.SyntaxKind.ObjectLiteralExpression],
    [ReflectionKind.TypeAlias]: [ts.SyntaxKind.TypeAliasDeclaration],
    [ReflectionKind.Event]: [], /// this needs to go away
    [ReflectionKind.Reference]: [
        ts.SyntaxKind.NamespaceExport,
        ts.SyntaxKind.ExportSpecifier,
    ],
};

export function discoverComment(
    symbol: ts.Symbol,
    kind: ReflectionKind,
    logger: Logger
): [ts.SourceFile, ts.CommentRange] | undefined {
    // For a module comment, we want the first one defined in the file,
    // not the last one, since that will apply to the import or declaration.
    const reverse = symbol.declarations?.some(ts.isSourceFile);

    const discovered: [ts.SourceFile, ts.CommentRange][] = [];

    for (const decl of symbol.declarations || []) {
        const text = decl.getSourceFile().text;
        if (wantedKinds[kind].includes(decl.kind)) {
            const node = declarationToCommentNode(decl);
            if (!node) {
                continue;
            }

            // Special behavior here! We temporarily put the implementation comment
            // on the reflection which contains all the signatures. This lets us pull
            // the comment on the implementation if some signature does not have a comment.
            // However, we don't want to skip the node if it is a reference to something.
            // See the gh1770 test for an example.
            if (
                kind & ReflectionKind.ContainsCallSignatures &&
                !(node as ts.FunctionDeclaration).body &&
                node.kind !== ts.SyntaxKind.BindingElement
            ) {
                continue;
            }

            const comments = ts.getLeadingCommentRanges(text, node.pos);

            if (reverse) {
                comments?.reverse();
            }

            const lastDocComment = comments?.find(
                (c) =>
                    text[c.pos] === "/" &&
                    text[c.pos + 1] === "*" &&
                    text[c.pos + 2] === "*"
            );

            if (lastDocComment) {
                discovered.push([decl.getSourceFile(), lastDocComment]);
            }
        }
    }

    switch (discovered.length) {
        case 0:
            return undefined;
        case 1:
            return discovered[0];
        default: {
            logger.warn(
                `${symbol.name} has multiple declarations with a comment. An arbitrary comment will be used.`
            );
            const locations = discovered.map(([sf, { pos }]) => {
                const path = nicePath(sf.fileName);
                const line = ts.getLineAndCharacterOfPosition(sf, pos).line + 1;
                return `${path}:${line}`;
            });
            logger.info(
                `The comments for ${
                    symbol.name
                } are declared at:\n\t${locations.join("\n\t")}`
            );
            return discovered[0];
        }
    }
}

export function discoverSignatureComment(
    declaration: ts.SignatureDeclaration | ts.JSDocSignature
): [ts.SourceFile, ts.CommentRange] | undefined {
    const node = declarationToCommentNode(declaration);
    if (!node) {
        return;
    }

    const text = node.getSourceFile().text;
    const comments = ts.getLeadingCommentRanges(text, node.pos);

    const comment = comments?.find(
        (c) =>
            text[c.pos] === "/" &&
            text[c.pos + 1] === "*" &&
            text[c.pos + 2] === "*"
    );

    if (comment) {
        return [node.getSourceFile(), comment];
    }
}

/**
 * Check whether the given module declaration is the topmost.
 *
 * This function returns TRUE if there is no trailing module defined, in
 * the following example this would be the case only for module <code>C</code>.
 *
 * ```
 * module A.B.C { }
 * ```
 *
 * @param node  The module definition that should be tested.
 * @return TRUE if the given node is the topmost module declaration, FALSE otherwise.
 */
function isTopmostModuleDeclaration(node: ts.ModuleDeclaration): boolean {
    return node.getChildren().some(ts.isModuleBlock);
}

/**
 * Return the root module declaration of the given module declaration.
 *
 * In the following example this function would always return module
 * <code>A</code> no matter which of the modules was passed in.
 *
 * ```
 * module A.B.C { }
 * ```
 */
function getRootModuleDeclaration(node: ts.ModuleDeclaration): ts.Node {
    while (
        node.parent &&
        node.parent.kind === ts.SyntaxKind.ModuleDeclaration
    ) {
        const parent = node.parent;
        if (node.name.pos === parent.name.end + 1) {
            node = parent;
        } else {
            break;
        }
    }

    return node;
}

function declarationToCommentNode(node: ts.Declaration): ts.Node | undefined {
    if (node.parent?.kind === ts.SyntaxKind.VariableDeclarationList) {
        return node.parent.parent;
    }

    if (node.kind === ts.SyntaxKind.ModuleDeclaration) {
        if (!isTopmostModuleDeclaration(<ts.ModuleDeclaration>node)) {
            return;
        } else {
            return getRootModuleDeclaration(<ts.ModuleDeclaration>node);
        }
    }

    if (node.kind === ts.SyntaxKind.ExportSpecifier) {
        return node.parent.parent;
    }

    if (
        [
            ts.SyntaxKind.NamespaceExport,
            ts.SyntaxKind.FunctionExpression,
            ts.SyntaxKind.FunctionType,
            ts.SyntaxKind.FunctionType,
            ts.SyntaxKind.ArrowFunction,
        ].includes(node.kind)
    ) {
        return node.parent;
    }

    return node;
}
