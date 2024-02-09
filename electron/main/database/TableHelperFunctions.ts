import { DBEntry, DBQueryResult, DatabaseFields } from "./Schema";
import {
  GetFilesInfoList,
  flattenFileInfoTree,
  readFile,
} from "../Files/Filesystem";
import { FileInfo, FileInfoTree } from "../Files/Types";
import { chunkMarkdownByHeadingsAndByCharsIfBig } from "../RAG/Chunking";
import { LanceDBTableWrapper } from "./LanceTableWrapper";

export const repopulateTableWithMissingItems = async (
  table: LanceDBTableWrapper,
  directoryPath: string,
  onProgress?: (progress: number) => void
) => {
  const filesInfoTree = GetFilesInfoList(directoryPath);
  console.log("got files info list: ", filesInfoTree.length);
  if (filesInfoTree.length > 0) {
    console.log("files info tree length: ", filesInfoTree[0]);
  }
  const tableArray = await getTableAsArray(table);
  console.log("got table as array: " + tableArray.length);
  if (tableArray.length > 0) {
    console.log("table array: ", tableArray[0]);
  }
  const dbItemsToAdd = await computeDbItemsToAdd(filesInfoTree, tableArray);
  console.log("got db items to add: ", dbItemsToAdd.length);
  if (dbItemsToAdd.length > 0) {
    console.log("db items to add length: ", dbItemsToAdd[0]);
  }
  if (dbItemsToAdd.length == 0) {
    console.log("no items to add");
    onProgress && onProgress(1);
    return;
  }
  const filePathsToDelete = dbItemsToAdd.map((x) => x[0].notepath);
  console.log("deleting db items by file paths: ", filePathsToDelete.length);
  if (filePathsToDelete.length > 0) {
    console.log("file paths to delete length: ", filePathsToDelete[0]);
  }
  await table.deleteDBItemsByFilePaths(filePathsToDelete);
  console.log("done deleting");

  const flattenedItemsToAdd = dbItemsToAdd.flat();
  console.log("flattened items to add: ", flattenedItemsToAdd.length);
  if (flattenedItemsToAdd.length > 0) {
    console.log("flattened items to add length: ", flattenedItemsToAdd[0]);
  }
  await table.add(flattenedItemsToAdd, onProgress);
  console.log("done adding");
  onProgress && onProgress(1);
};

const getTableAsArray = async (table: LanceDBTableWrapper) => {
  console.log("starting table count:");
  const totalRows = await table.countRows();
  if (totalRows == 0) {
    console.log("total rows is 0");
    return [];
  }
  console.log("total rows: ", totalRows);
  const nonEmptyResults = await table.filter(
    `${DatabaseFields.CONTENT} != ''`,
    totalRows
  );
  console.log("non empty results: ", nonEmptyResults.length);
  const emptyResults = await table.filter(
    `${DatabaseFields.CONTENT} = ''`,
    totalRows
  );
  console.log("empty results: ", emptyResults.length);
  const results = nonEmptyResults.concat(emptyResults);
  console.log("concated results: ", results.length);
  return results;
};

const computeDbItemsToAdd = async (
  filesInfoList: FileInfo[],
  tableArray: DBEntry[]
): Promise<DBEntry[][]> => {
  const promises = filesInfoList.map(convertFileTypeToDBType);

  const filesAsChunksToAddToDB = await Promise.all(promises);

  return filesAsChunksToAddToDB.filter((chunksBelongingToFile) =>
    filterChunksNotInTable(chunksBelongingToFile, tableArray)
  );
};

const filterChunksNotInTable = (
  chunksBelongingToFile: DBEntry[],
  tableArray: DBEntry[]
): boolean => {
  if (chunksBelongingToFile.length == 0) {
    return false;
  }
  if (chunksBelongingToFile[0].content == "") {
    return false;
  }
  const notepath = chunksBelongingToFile[0].notepath;
  const itemsAlreadyInTable = tableArray.filter(
    (item) => item.notepath == notepath
  );
  return chunksBelongingToFile.length != itemsAlreadyInTable.length;
};

// const computeDbItemsToAddWithTableReference = async (
//   filesInfoList: FileInfo[],
//   table: LanceDBTableWrapper
// ): Promise<DBEntry[][]> => {
//   const conversionPromises = filesInfoList.map(convertFileTypeToDBType);
//   const filesAsChunksToAddToDB = await Promise.all(conversionPromises);

//   const filterPromises = filesAsChunksToAddToDB.map(
//     (chunksBelongingToFile, index) => {
//       console.log("index is: ", index);
//       return filterChunksNotInTableWithTableReference(
//         chunksBelongingToFile,
//         table
//       );
//     }
//   );

//   const filterResults = await Promise.all(filterPromises);

//   const outputChunks = filesAsChunksToAddToDB.filter(
//     (_, index) => filterResults[index]
//   );
//   return outputChunks;
// };

// const filterChunksNotInTableWithTableReference = async (
//   chunksBelongingToFile: DBEntry[],
//   table: LanceDBTableWrapper
// ): Promise<boolean> => {
//   if (chunksBelongingToFile.length == 0) {
//     return false;
//   }
//   if (chunksBelongingToFile[0].content == "") {
//     return false;
//   }
//   const notepath = chunksBelongingToFile[0].notepath;
//   const itemsAlreadyInTable = await table.filter(
//     `${DatabaseFields.NOTE_PATH} = '${notepath}'`
//   );
//   return chunksBelongingToFile.length != itemsAlreadyInTable.length;
// };

const convertFileTreeToDBEntries = async (
  tree: FileInfoTree
): Promise<DBEntry[]> => {
  const flattened = flattenFileInfoTree(tree);

  // Map each file info to a promise using the async function
  const promises = flattened.map(convertFileTypeToDBType);

  // Wait for all promises to resolve
  const entries = await Promise.all(promises);

  return entries.flat();
};

const convertFileTypeToDBType = async (file: FileInfo): Promise<DBEntry[]> => {
  const fileContent = readFile(file.path);
  const chunks = await chunkMarkdownByHeadingsAndByCharsIfBig(fileContent);
  const entries = chunks.map((content, index) => {
    return {
      notepath: file.path,
      content: content,
      subnoteindex: index,
      timeadded: new Date(),
      filemodified: file.dateModified,
    };
  });
  return entries;
};

export function sanitizePathForDatabase(filePath: string): string {
  return filePath.replace(/'/g, "''");
}

export function unsanitizePathForFileSystem(dbPath: string): string {
  return dbPath.replace(/''/g, "'");
}

export const addTreeToTable = async (
  dbTable: LanceDBTableWrapper,
  fileTree: FileInfoTree
): Promise<void> => {
  const dbEntries = await convertFileTreeToDBEntries(fileTree);
  await dbTable.add(dbEntries);
};

export const removeTreeFromTable = async (
  dbTable: LanceDBTableWrapper,
  fileTree: FileInfoTree
): Promise<void> => {
  const flattened = flattenFileInfoTree(fileTree);
  const filePaths = flattened.map((x) => x.path);
  await dbTable.deleteDBItemsByFilePaths(filePaths);
};

export const updateFileInTable = async (
  dbTable: LanceDBTableWrapper,
  filePath: string,
  content: string
): Promise<void> => {
  await dbTable.deleteDBItemsByFilePaths([filePath]);
  const currentTimestamp: Date = new Date();
  console.log("starting chunk");
  const chunkedContentList = await chunkMarkdownByHeadingsAndByCharsIfBig(
    content
  );
  console.log("done chunk");
  const dbEntries = chunkedContentList.map((content, index) => {
    return {
      notepath: filePath,
      content: content,
      subnoteindex: index,
      timeadded: currentTimestamp,
      filemodified: currentTimestamp,
    };
  });
  console.log("db entreis: ", dbEntries.length);
  await dbTable.add(dbEntries);
};

export function convertLanceEntryToDBEntry(
  record: Record<string, unknown>
): DBEntry | null {
  if (
    DatabaseFields.NOTE_PATH in record &&
    DatabaseFields.VECTOR in record &&
    DatabaseFields.CONTENT in record &&
    DatabaseFields.SUB_NOTE_INDEX in record &&
    DatabaseFields.TIME_ADDED in record
  ) {
    const recordAsDBQueryType = record as unknown as DBEntry;
    recordAsDBQueryType.notepath = unsanitizePathForFileSystem(
      recordAsDBQueryType.notepath
    );
    return recordAsDBQueryType;
  }
  return null;
}

export function convertLanceResultToDBResult(
  record: Record<string, unknown>
): DBQueryResult | null {
  if (
    DatabaseFields.NOTE_PATH in record &&
    DatabaseFields.VECTOR in record &&
    DatabaseFields.CONTENT in record &&
    DatabaseFields.SUB_NOTE_INDEX in record &&
    DatabaseFields.TIME_ADDED in record &&
    DatabaseFields.DISTANCE in record
  ) {
    const recordAsDBQueryType = record as unknown as DBQueryResult;
    recordAsDBQueryType.notepath = unsanitizePathForFileSystem(
      recordAsDBQueryType.notepath
    );
    return recordAsDBQueryType;
  }
  return null;
}
