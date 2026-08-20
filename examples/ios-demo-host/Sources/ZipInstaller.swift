import Foundation

enum ZipInstaller {
    private static let localSignature: UInt32 = 0x0403_4b50
    private static let centralSignature: UInt32 = 0x0201_4b50
    private static let endSignature: UInt32 = 0x0605_4b50

    static func extract(_ archive: Data, to destination: URL) throws {
        guard archive.count >= 22 else { throw HostFailure("Asset ZIP is truncated") }
        let minimum = max(0, archive.count - 65_557)
        guard let endOffset = stride(from: archive.count - 22, through: minimum, by: -1)
            .first(where: { archive.uint32LE(at: $0) == endSignature }) else {
            throw HostFailure("Asset ZIP has no central directory")
        }

        let disk = archive.uint16LE(at: endOffset + 4)
        let centralDisk = archive.uint16LE(at: endOffset + 6)
        let entryCount = Int(archive.uint16LE(at: endOffset + 10))
        let centralSize = Int(archive.uint32LE(at: endOffset + 12))
        let centralOffset = Int(archive.uint32LE(at: endOffset + 16))
        guard disk == 0, centralDisk == 0, entryCount > 0, entryCount <= maxArchiveEntries,
              centralOffset <= archive.count, centralSize <= archive.count - centralOffset else {
            throw HostFailure("Asset ZIP directory is invalid")
        }

        let files = FileManager.default
        try files.createDirectory(at: destination, withIntermediateDirectories: true)
        var cursor = centralOffset
        var totalUnpacked = 0
        for _ in 0..<entryCount {
            guard cursor <= archive.count - 46, archive.uint32LE(at: cursor) == centralSignature else {
                throw HostFailure("Asset ZIP entry header is invalid")
            }
            let flags = archive.uint16LE(at: cursor + 8)
            let method = archive.uint16LE(at: cursor + 10)
            let expectedCRC = archive.uint32LE(at: cursor + 16)
            let compressedSize = Int(archive.uint32LE(at: cursor + 20))
            let unpackedSize = Int(archive.uint32LE(at: cursor + 24))
            let nameLength = Int(archive.uint16LE(at: cursor + 28))
            let extraLength = Int(archive.uint16LE(at: cursor + 30))
            let commentLength = Int(archive.uint16LE(at: cursor + 32))
            let externalAttributes = archive.uint32LE(at: cursor + 38)
            let localOffset = Int(archive.uint32LE(at: cursor + 42))
            let next = cursor + 46 + nameLength + extraLength + commentLength
            guard next <= archive.count, nameLength > 0, flags & 1 == 0,
                  method == 0 || method == 8 else {
                throw HostFailure("Asset ZIP contains an unsupported entry")
            }

            let nameRange = (cursor + 46)..<(cursor + 46 + nameLength)
            guard let name = String(data: archive.subdata(in: nameRange), encoding: .utf8),
                  safeRelativePath(name, allowTrailingSlash: true),
                  UInt16(externalAttributes >> 16) & 0o170000 != 0o120000 else {
                throw HostFailure("Asset ZIP contains an unsafe entry path")
            }
            let (updatedTotal, overflow) = totalUnpacked.addingReportingOverflow(unpackedSize)
            guard !overflow, updatedTotal <= maxUnpackedBytes,
                  localOffset <= archive.count - 30,
                  archive.uint32LE(at: localOffset) == localSignature else {
                throw HostFailure("Asset ZIP exceeds its extraction limits")
            }
            totalUnpacked = updatedTotal

            let target = destination.appendingPathComponent(name)
            if name.hasSuffix("/") {
                try files.createDirectory(at: target, withIntermediateDirectories: true)
            } else {
                let localNameLength = Int(archive.uint16LE(at: localOffset + 26))
                let localExtraLength = Int(archive.uint16LE(at: localOffset + 28))
                let dataOffset = localOffset + 30 + localNameLength + localExtraLength
                guard dataOffset <= archive.count, compressedSize <= archive.count - dataOffset else {
                    throw HostFailure("Asset ZIP entry data is truncated")
                }
                let compressed = archive.subdata(in: dataOffset..<(dataOffset + compressedSize))
                let data = method == 0
                    ? try stored(compressed, expectedSize: unpackedSize)
                    : try inflated(compressed, expectedSize: unpackedSize)
                guard data.crc32 == expectedCRC else {
                    throw HostFailure("Asset ZIP entry checksum failed")
                }
                try files.createDirectory(at: target.deletingLastPathComponent(),
                                          withIntermediateDirectories: true)
                try data.write(to: target, options: .atomic)
            }
            cursor = next
        }
    }

    private static func stored(_ data: Data, expectedSize: Int) throws -> Data {
        guard data.count == expectedSize else { throw HostFailure("Stored ZIP entry size is invalid") }
        return data
    }

    private static func inflated(_ data: Data, expectedSize: Int) throws -> Data {
        var output = Data(count: max(expectedSize, 1))
        let outputCapacity = output.count
        var stream = z_stream()
        let initialization = inflateInit2_(&stream, -MAX_WBITS, ZLIB_VERSION,
                                           Int32(MemoryLayout<z_stream>.size))
        guard initialization == Z_OK else { throw HostFailure("Could not initialize ZIP decompression") }
        defer { inflateEnd(&stream) }

        let status = data.withUnsafeBytes { input in
            output.withUnsafeMutableBytes { destination in
                stream.next_in = UnsafeMutablePointer<Bytef>(
                    mutating: input.baseAddress?.assumingMemoryBound(to: Bytef.self)
                )
                stream.avail_in = uInt(data.count)
                stream.next_out = destination.baseAddress?.assumingMemoryBound(to: Bytef.self)
                stream.avail_out = uInt(outputCapacity)
                return inflate(&stream, Z_FINISH)
            }
        }
        guard status == Z_STREAM_END, Int(stream.total_out) == expectedSize else {
            throw HostFailure("ZIP entry decompression failed")
        }
        output.count = expectedSize
        return output
    }
}

private extension Data {
    func uint16LE(at offset: Int) -> UInt16 {
        UInt16(self[offset]) | UInt16(self[offset + 1]) << 8
    }

    func uint32LE(at offset: Int) -> UInt32 {
        UInt32(self[offset]) | UInt32(self[offset + 1]) << 8 |
            UInt32(self[offset + 2]) << 16 | UInt32(self[offset + 3]) << 24
    }

    var crc32: UInt32 {
        withUnsafeBytes { bytes in
            UInt32(runeweave_crc32(bytes.baseAddress?.assumingMemoryBound(to: Bytef.self), uInt(count)))
        }
    }
}
